import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './styles.css'

function render(): void {
  const root = document.getElementById('root')
  if (root === null) throw new Error('task pane root is missing')
  createRoot(root).render(<App />)
}

void Office.onReady((info) => {
  if (info.host !== Office.HostType.Excel) {
    const root = document.getElementById('root')
    if (root !== null) root.textContent = '此加载项只能在 Microsoft Excel 中运行。'
    return
  }
  render()
})
