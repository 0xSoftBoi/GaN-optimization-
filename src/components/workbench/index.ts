/** Workbench UI public API. */

export * from "./format";
export * from "./examples";
export { LossWaterfall, EfficiencyChart } from "./charts";
export {
  BomPanel,
  CompliancePanel,
  ComplianceVerdictCard,
  DeviceTable,
  ErrorPanel,
  FirmwarePanel,
  LayoutPanel,
  MagneticsCards,
  RationalePanel,
  SchematicPanel,
  StagedProgress,
  StatsRow,
  ThermalPanel,
  WarningsStrip,
  downloadBlob,
} from "./panels";
export { SpecForm } from "./SpecForm";
export { ImpactPanel } from "./ImpactPanel";
export {
  buildSummaryMarkdown,
  complianceConsequence,
  complianceVerdict,
  friendlyErrorMessage,
  impactSentence,
  type ComplianceSummary,
} from "./summary";
