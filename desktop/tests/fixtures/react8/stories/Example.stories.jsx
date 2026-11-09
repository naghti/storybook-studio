import React, { useState } from 'react';
import { userEvent } from '@storybook/test';
function Example() {
  const [clicked, setClicked] = useState(false);
  return <button style={{ padding: 20, background: '#2563eb', color: 'white' }} onClick={() => setClicked(true)}>{clicked ? 'React play completed' : 'Hello from React'}</button>;
}
export default { title: 'Example/React', component: Example };
export const Default = {};
export const WithPlay = {
  play: async ({ canvasElement }) => {
    await new Promise(resolve => setTimeout(resolve, 700));
    await userEvent.click(canvasElement.querySelector('button'));
    await new Promise(resolve => setTimeout(resolve, 100));
    if (!canvasElement.textContent.includes('React play completed')) throw new Error('Interaction failed');
  },
};
export const Broken = { render: () => { throw new Error('Intentional render failure'); } };
