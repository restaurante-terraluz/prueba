function mediaFallback(img){
  img.style.display = 'none';
  var ph = img.nextElementSibling;
  if (ph) ph.style.display = 'flex';
}

function toggleMenu(open){
  var overlay = document.getElementById('menu-overlay');
  if (!overlay) return;
  overlay.classList.toggle('open', open);
}

document.addEventListener('DOMContentLoaded', function(){
  var openBtn = document.getElementById('menu-open');
  var closeBtn = document.getElementById('menu-close');
  if (openBtn) openBtn.addEventListener('click', function(){ toggleMenu(true); });
  if (closeBtn) closeBtn.addEventListener('click', function(){ toggleMenu(false); });

  var overlay = document.getElementById('menu-overlay');
  if (overlay){
    overlay.querySelectorAll('a').forEach(function(a){
      a.addEventListener('click', function(){ toggleMenu(false); });
    });
  }

  var lightbox = document.getElementById('lightbox-overlay');
  if (lightbox){
    var lightboxImg = document.getElementById('lightbox-img');
    var lightboxClose = document.getElementById('lightbox-close');
    var closeLightbox = function(){
      lightbox.classList.remove('open');
      lightboxImg.src = '';
    };
    document.querySelectorAll('.media-frame--zoom img').forEach(function(img){
      img.addEventListener('click', function(){
        if (img.style.display === 'none') return; /* imagen rota, no abrir */
        lightboxImg.src = img.src;
        lightboxImg.alt = img.alt;
        lightbox.classList.add('open');
      });
    });
    lightboxClose.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', function(e){
      if (e.target === lightbox) closeLightbox();
    });
    document.addEventListener('keydown', function(e){
      if (e.key === 'Escape') closeLightbox();
    });
  }

  if ('IntersectionObserver' in window){
    var observer = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if (entry.isIntersecting) entry.target.classList.add('visible');
      });
    }, { threshold: 0.15 });
    document.querySelectorAll('.reveal').forEach(function(el){ observer.observe(el); });
  } else {
    document.querySelectorAll('.reveal').forEach(function(el){ el.classList.add('visible'); });
  }
});
