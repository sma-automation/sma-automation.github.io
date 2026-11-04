const frame=document.getElementById('exampleFrame');
for(const button of document.querySelectorAll('[data-size]'))button.addEventListener('click',()=>{
 for(const item of document.querySelectorAll('[data-size]'))item.setAttribute('aria-pressed',String(item===button));
 frame.classList.toggle('mobile',button.dataset.size==='mobile');
});
