# Informe: integración de Claude Code con GitLab

**Autor:** Víctor Herráiz (vherraiz) · **Fecha:** 2026-06-29
**Instancia GitLab:** `http://192.168.0.22` (self-hosted, versión **17.0.8 CE**)
**Objetivo:** permitir que Claude Code ejecute acciones sobre GitLab (abrir/gestionar issues, MRs, etc.) y evaluar si conviene estandarizar el método en el equipo.

---

## 1. Resumen ejecutivo

Tras probar dos vías basadas en **MCP** (Model Context Protocol) sin éxito en el entorno actual, la integración que **sí funciona hoy** es una **conexión directa a la API REST de GitLab (v4)** mediante un pequeño script auxiliar que Claude invoca desde la terminal.

- ✅ **Funciona:** API REST v4 + Personal Access Token (PAT), vía script helper.
- ⚠️ **No disponible:** MCP nativo de GitLab (requiere versión más reciente que la 17.0.8).
- ⚠️ **No operativo en VSCode:** servidor MCP comunitario `@zereight/mcp-gitlab` (conecta por CLI pero sus *tools* no aparecen en la extensión de VSCode).

La principal observación de seguridad es que la instancia se sirve por **HTTP (sin TLS)**, por lo que el token viaja en claro por la red. Es el punto a corregir antes de estandarizar.

---

## 2. Métodos evaluados

### 2.1 MCP nativo de GitLab (descartado)
- Configurado como servidor MCP HTTP apuntando a `http://192.168.0.22/api/v4/mcp`.
- Resultado: **HTTP 404**. El endpoint MCP nativo no existe en GitLab 17.0.8 (es una funcionalidad introducida en versiones posteriores de la rama 17.x).
- Conclusión: viable solo tras actualizar la instancia.

### 2.2 Servidor MCP comunitario `@zereight/mcp-gitlab` (no operativo aquí)
- Añadido con:
  ```
  claude mcp add GitLab \
    --env GITLAB_PERSONAL_ACCESS_TOKEN=*** \
    --env GITLAB_API_URL=http://192.168.0.22/api/v4 \
    -- cmd /c npx -y @zereight/mcp-gitlab
  ```
  (En Windows hay que envolver `npx` en `cmd /c` para que el proceso arranque correctamente.)
- `claude mcp get GitLab` reporta **✓ Connected** y, lanzado a mano, el servidor arranca y valida la configuración.
- **Problema:** las herramientas del servidor **no se cargan en la sesión de la extensión de Claude Code para VSCode** (no aparecen como tools utilizables), ni siquiera reiniciando VSCode. Queda pendiente de revisar (posible incompatibilidad de la extensión con servidores MCP stdio locales en Windows).

### 2.3 API REST v4 directa (MÉTODO EN USO) ✅
- Claude llama a la API REST de GitLab con `curl` a través de un script auxiliar.
- Autenticación: cabecera `PRIVATE-TOKEN: <PAT>`.
- Endpoint base: `http://192.168.0.22/api/v4`.

**Script helper** (`~/.claude/gitlab-api.sh`):
```bash
#!/usr/bin/env bash
set -euo pipefail
CLAUDE_JSON="C:/Users/VICTOR/.claude.json"
PROJECT_KEY="...ruta del proyecto..."
BASE="http://192.168.0.22/api/v4"
# El token se lee en tiempo de ejecución a una variable; nunca se imprime ni se escribe en el script.
TOKEN=$(python -c "import json;d=json.load(open(r'$CLAUDE_JSON',encoding='utf-8'));print(d['projects']['$PROJECT_KEY']['mcpServers']['GitLab']['env']['GITLAB_PERSONAL_ACCESS_TOKEN'],end='')")
APIPATH="$1"; shift || true
curl -s -H "PRIVATE-TOKEN: $TOKEN" "$@" "$BASE$APIPATH"
```

Ejemplos de uso:
```bash
# Leer usuario autenticado
bash gitlab-api.sh "/user"

# Listar issues de un proyecto (id 87)
bash gitlab-api.sh "/projects/87/issues?state=all"

# Crear un issue
bash gitlab-api.sh "/projects/87/issues" -X POST \
  --data-urlencode "title=Título" \
  --data-urlencode "labels=bug" \
  --data-urlencode "description@cuerpo.md"
```

Para operaciones en lote (p. ej. crear 9 issues) se usó un script Python con `urllib` que: lee el token **una sola vez**, **reintenta** ante fallos de red transitorios, y **comprueba títulos existentes** para no crear duplicados.

**Nota operativa:** la red local mostró fallos intermitentes en POST consecutivos (respuestas vacías). El script Python con reintentos + control de duplicados resolvió el problema de forma robusta; el bucle de `curl` sin reintentos no es fiable para lotes.

---

## 3. Seguridad de la conexión

| Aspecto | Estado actual | Riesgo | Recomendación |
|---|---|---|---|
| **Transporte** | HTTP sin TLS | 🔴 Alto — el PAT y los datos viajan en claro por la LAN; capturables con sniffing | Servir GitLab por **HTTPS** y usar la URL `https://` |
| **Token en reposo** | PAT en texto plano en `%USERPROFILE%\.claude.json` (config local del proyecto) | 🟠 Medio — legible por cualquier proceso del usuario | Guardar en gestor de secretos del SO / variable de entorno inyectada en runtime |
| **Token en el script** | El helper **no** contiene el token (lo lee dinámicamente) y **no** lo imprime | 🟢 Bajo | Mantener este patrón (no hardcodear, no `echo`) |
| **Alcance del token** | PAT con scope `api` (lectura+escritura completa) | 🟠 Medio — permisos amplios | Mínimo privilegio: `read_api` + scopes concretos, o **Project/Group Access Token**, o usuario *bot* dedicado |
| **Caducidad** | Sin verificar | 🟠 Medio | Establecer expiración y rotación periódica |
| **Exposición en historial** | El PAT se pegó en el chat y apareció en la salida de `claude mcp` | 🔴 Alto para *este* token concreto | **Rotar este PAT** y, en adelante, configurar tokens fuera del chat |

**Conclusión de seguridad:** el mecanismo (token en cabecera, leído sin imprimirse) es razonable, pero **HTTP en claro** y **scope amplio** son los dos puntos a corregir antes de estandarizar. El token usado en esta prueba debe rotarse porque quedó en el historial de la conversación.

---

## 4. Coste en tokens (de Claude)

Se refiere al consumo de **contexto del LLM**, no a tokens de GitLab. El coste lo dominan dos factores: el tamaño del JSON de la API que se vuelca al contexto y los errores/tracebacks.

| Operación | Coste aprox. (tokens de contexto) |
|---|---|
| Llamada de lectura simple resumida (p. ej. `/user`) | ~300–800 |
| Listar issues (resumido a `#id · título`) | ~400–700 |
| Crear 1 issue (comando + respuesta resumida a `iid` + URL) | ~300–600 |
| Volcar JSON **crudo** de la API al contexto | 1.5k–6k+ (a evitar) |
| Traceback de error | ~300–500 cada uno (desperdicio) |

**Estimación práctica:** crear un issue bien formado y verificarlo cuesta del orden de **0,5–2k tokens**. Un lote de 9 issues con scripting limpio (una sola pasada Python que devuelve un resumen compacto) tiene un coste marginal bajo por issue; los grandes sumideros son volcar JSON crudo y reintentar a ciegas.

**Recomendación:** los scripts deben devolver **resúmenes compactos** (id, título, URL) en vez de JSON completo. El helper actual ya lo hace.

---

## 5. Recomendaciones para estandarizar en el equipo

1. **Servir GitLab por HTTPS.** Prerrequisito de seguridad para cualquier integración con tokens.
2. **Gestión de credenciales:**
   - Usar **Project/Group Access Tokens** o un **usuario bot** dedicado en lugar de PAT personales.
   - **Mínimo privilegio** (`read_api` + scopes concretos; `api` solo si se requiere escritura).
   - **Caducidad + rotación**; nunca pegar tokens en chats/logs.
   - Almacenar en el **gestor de secretos del SO** o variable de entorno, no en config en claro.
3. **Tooling (por orden de preferencia):**
   - **a)** *MCP nativo de GitLab* — cuando la instancia se actualice a una versión que lo soporte. Integración de primera clase.
   - **b)** **`glab`** (CLI oficial de GitLab) — maduro, gestiona auth/config y cubre issues/MRs/pipelines; ideal para uso scriptado y reproducible por todo el equipo.
   - **c)** *MCP comunitario `@zereight/mcp-gitlab`* — reevaluar por qué no carga en la extensión de VSCode; si se resuelve, da una experiencia más integrada.
   - **d)** **Helper REST (método actual)** — el más simple y portable; buen *fallback* mientras no haya MCP. Mantener el patrón de "token leído sin imprimir" y respuestas resumidas.
4. **Buenas prácticas para Claude:** scripts que devuelvan resúmenes compactos (control de coste de tokens), reintentos + control de duplicados en operaciones de escritura por lotes.

---

## 6. Estado de esta prueba

- ✅ Autenticación validada (`/user` → `vherraiz`, id 25).
- ✅ Issue de prueba creado y verificado en `uah/dual-comb/firmware#3` (pendiente de borrado manual).
- ✅ 9 issues documentados creados en `sarcape/coverage-plan` (#1–#9), cada uno con su categoría (bug/enhancement/documentation) y el mensaje de inspección completo verbatim.
