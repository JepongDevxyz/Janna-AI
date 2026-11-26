/* Phone viewport handling. Never blocks touchmove or disables pinch zoom. */
(() => {
  const isPhone = () => matchMedia('(max-width: 700px)').matches
    || (matchMedia('(pointer: coarse)').matches && matchMedia('(display-mode: standalone)').matches);
  let frame = 0;
  const update = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const viewport = window.visualViewport;
      const mobile = isPhone();
      document.body.classList.toggle('phone-layout', mobile);
      if (!mobile) return;
      if (viewport && viewport.scale > 1.05) return;
      const height = viewport?.height || window.innerHeight;
      document.documentElement.style.setProperty('--phone-height', `${height}px`);
      document.documentElement.style.setProperty('--phone-top', `${viewport?.offsetTop || 0}px`);
      document.body.classList.toggle('keyboard-open', window.innerHeight - height > 120);
    });
  };
  window.addEventListener('resize', update, { passive: true });
  window.visualViewport?.addEventListener('resize', update, { passive: true });
  window.visualViewport?.addEventListener('scroll', update, { passive: true });
  document.addEventListener('focusin', update);
  document.addEventListener('focusout', update);
  document.addEventListener('dragstart', (event) => {
    if (isPhone() && event.target instanceof HTMLImageElement) event.preventDefault();
  });
  window.updatePhoneLayout = update;
  update();
})();
