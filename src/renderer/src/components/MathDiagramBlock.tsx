import { CylinderVolumeProof, parseMathDiagramAttributes } from "./MathDiagram.js";

export function MathDiagramBlock({ source }: { source: string }) {
  const props = parseMathDiagramAttributes(source);
  return props ? <CylinderVolumeProof {...props} /> : <pre className="math-diagram-error">不支持的数学图示组件。当前支持 CylinderVolumeProof。</pre>;
}
