// Layout (dueño: orquestador). Cada agente llena su componente.
import { Toolbar } from './ui/grid/Toolbar';
import { FormulaBar } from './ui/grid/FormulaBar';
import { Grid } from './ui/grid/Grid';
import { SheetTabs } from './ui/grid/SheetTabs';
import { ChatPanel } from './ui/chat/ChatPanel';
import { ChartsLayer } from './ui/charts/ChartsLayer';
import { MacrosPanel } from './ui/macros/MacrosPanel';
import './styles.css';
export default function App() {
  return (
    <div className="app">
      <div className="main">
        <Toolbar />
        <FormulaBar />
        <div className="grid-area"><Grid /><ChartsLayer /></div>
        <SheetTabs />
        <MacrosPanel />
      </div>
      <ChatPanel />
    </div>
  );
}
