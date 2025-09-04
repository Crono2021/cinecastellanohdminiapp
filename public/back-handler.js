(function () {
  function isOpen(){return !!document.querySelector('.modal.open,.popup-ficha.is-open,.popup-ficha[aria-hidden="false"]')}
  function closeIt(){
    var btn=document.querySelector('.modal.open .btn-cerrar,.modal.open [data-close],.popup-ficha.is-open .btn-cerrar-ficha,.popup-ficha[aria-hidden="false"] .btn-cerrar-ficha');
    if(btn){btn.click();return;}
    var m=document.querySelector('.modal.open'); if(m) m.classList.remove('open');
    var p=document.querySelector('.popup-ficha.is-open,.popup-ficha[aria-hidden="false"]');
    if(p){p.classList.remove('is-open');p.setAttribute('aria-hidden','true');p.style.display='none';}
  }
  function ensureBase(){try{if(!history.state||!history.state._base){history.replaceState({_base:true,t:Date.now()},'',location.href)}}catch(e){}}
  function watch(){var mo=new MutationObserver(function(){if(isOpen()){try{history.pushState({modal:true,t:Date.now()},'',location.href)}catch(e){}}});mo.observe(document.documentElement,{attributes:true,childList:true,subtree:true,attributeFilter:['class','style','aria-hidden']});if(isOpen()){try{history.pushState({modal:true},'',location.href)}catch(e){}}}
  window.addEventListener('popstate',function(){if(isOpen()){closeIt();try{history.pushState({restore:true,t:Date.now()},'',location.href)}catch(e){}}});
  document.addEventListener('backbutton',function(ev){if(isOpen()){ev.preventDefault();closeIt();}},false);
  ensureBase();watch();
})();