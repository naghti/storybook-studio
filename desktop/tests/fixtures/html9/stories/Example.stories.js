export default { title: 'Example/HTML', render: () => '<button style="padding:20px;background:#6366f1;color:white">Hello from HTML</button>' };
export const Default = {};
export const WithPlay = {
  play: async ({ canvasElement }) => {
    await new Promise(resolve => setTimeout(resolve, 700));
    canvasElement.querySelector('button').textContent = 'Play completed';
    canvasElement.querySelector('button').style.background = '#15803d';
  },
};
export const PermanentLoading = {
  render: () => {
    fetch('./pending').catch(() => {});
    return '<div role="status" style="background:#eee;padding:30px">Waiting for data…</div>';
  },
};
export const Broken = { render: () => { throw new Error('Intentional render failure'); } };
export const BrokenPlay = { play: async () => { throw new Error('Intentional play failure'); } };
export const Skipped = { parameters: { loki: { skip: true } } };
export const BrokenImage = { render: () => '<img src="./missing.png" alt="Missing resource">' };
