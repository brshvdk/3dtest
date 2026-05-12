import { Scene } from "./scene/Scene";
import { ControlPanel } from "./ui/ControlPanel";
import { StatsPanel } from "./ui/StatsPanel";

export default function App() {
  return (
    <div className="app">
      <ControlPanel />
      <div className="canvas-wrap">
        <Scene />
      </div>
      <StatsPanel />
    </div>
  );
}
