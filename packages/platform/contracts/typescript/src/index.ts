/**
 * Artifex Nexus — TypeScript contracts.
 * Re-export auto-generated types from `./generated/*` (run `pnpm codegen`).
 */
// export * from "./generated/manifest";
// export * from "./generated/config";
// export * from "./generated/stream-event";
// export * from "./generated/tool-item";

// ---- ANDF (M10 data view) ----
export type {
  ArtifexNexusDataFormat,
  Column,
  View,
} from "./generated/andf";
export type { Meta as ANDFMeta } from "./generated/andf";
/** ANDF 类型别名（domain name），映射到 auto-generated ArtifexNexusDataFormat */
export type ANDF = import("./generated/andf").ArtifexNexusDataFormat;

// ---- AWFF (M11 workflow editor) ----
export type {
  ArtifexNexusWorkflowFormat,
  Node as AWFFNode,
  Edge as AWFFEdge,
  Port,
  PortDataType,
  NodeKind,
  NodeType,
  Capabilities,
  Position,
  Variable,
  VariableType,
} from "./generated/awff";
export type { Meta as AWFFMeta } from "./generated/awff";
/** AWFF 类型别名（domain name），映射到 auto-generated ArtifexNexusWorkflowFormat */
export type AWFF = import("./generated/awff").ArtifexNexusWorkflowFormat;
/**
 * NodeStatus — 节点级 7 态（json2ts inline 了，这里手工抬到 top-level，与 awff.schema.json `NodeStatus` 保持一致）。
 * 单源仍是 schema；本类型作为 schema 的镜像导出，便于消费者使用。
 */
export type NodeStatus =
  | "pending"
  | "running"
  | "waiting"
  | "branched"
  | "done"
  | "skipped"
  | "error";
