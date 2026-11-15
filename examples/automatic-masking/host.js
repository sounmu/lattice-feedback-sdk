const translations = { summary: 'Order ' + 'summary' };
document.querySelector('#summary').textContent = translations.summary;

async function populate() {
  const data = await (await fetch('data.json')).json();
  for (const id of ['customer', 'order', 'amount', 'editable', 'masked', 'blocked', 'safe']) {
    document.getElementById(id).textContent = data[id];
  }
  for (const id of ['recipient', 'instructions', 'password']) {
    document.getElementById(id).value = data[id];
  }
  const option = document.getElementById('warehouse-option');
  option.textContent = data.warehouse;
  option.value = data.warehouse;
  const attributes = document.getElementById('attributes');
  for (const name of ['title', 'aria-label', 'data-account']) attributes.setAttribute(name, data.attribute);
  document.body.dataset.ready = 'true';
}
document.getElementById('refresh').addEventListener('click', async () => {
  const data = await (await fetch('mutation.json')).json();
  document.getElementById('updated').textContent = data.update;
  document.getElementById('customer').textContent = data.customer;
  document.getElementById('attributes').setAttribute('title', data.update);
  document.body.dataset.mutated = 'true';
});
void populate();

const sdk = document.createElement('script');
sdk.src = 'http://localhost:3141/sdk.js';
sdk.dataset.projectKey = 'demo';
sdk.dataset.capturePolicy = JSON.stringify({
  allowedPaths: ['/'],
  targets: [],
  automaticMasking: {
    enabled: new URLSearchParams(location.search).get('masking') !== 'off',
    keepCommentedText: new URLSearchParams(location.search).get('commented') === 'on',
  },
});
sdk.onload = () => window.LatticeFeedback.setUser({ id: 'masking-reviewer', name: 'Demo reviewer' });
document.body.append(sdk);
