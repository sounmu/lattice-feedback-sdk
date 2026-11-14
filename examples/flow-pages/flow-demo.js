document.querySelector('[data-feedback-id="save-button"]')?.addEventListener('click', () => {
  const result = document.getElementById('save-result');
  if (result) {
    result.textContent = `${document.title} 저장 완료`;
  }
});
