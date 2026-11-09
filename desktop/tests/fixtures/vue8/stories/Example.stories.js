export default { title: 'Example/Vue', render: () => ({ template: '<button style="padding:20px;background:#db2777;color:white">Hello from Vue</button>' }) };
export const Default = {};
export const WithPlay = {
  play: async ({ canvasElement }) => {
    await new Promise(resolve => setTimeout(resolve, 700));
    canvasElement.querySelector('button').textContent = 'Vue play completed';
  },
};
export const Broken = { render: () => { throw new Error('Intentional render failure'); } };
