import * as path from "path";

export type BundledVisualizationAssetEntry = {
  requestPath: string;
  bundledPath: string;
  license: string;
  sourceUrl: string;
  description: string;
  tags: string[];
};

export const HIGHMIX_BUNDLED_VISUALIZATION_ASSETS: BundledVisualizationAssetEntry[] = [
  {
    requestPath: "highmix/gearbox.glb",
    bundledPath: path.resolve(
      process.cwd(),
      "examples",
      "visualization-assets",
      "highmix",
      "GearboxAssy.glb",
    ),
    license: "CC0-1.0",
    sourceUrl: "https://github.com/KhronosGroup/glTF-Sample-Models/tree/master/2.0/GearboxAssy",
    description: "Machining cell proxy model for station geometry.",
    tags: ["highmix", "machine", "gearbox"],
  },
  {
    requestPath: "highmix/milktruck.glb",
    bundledPath: path.resolve(
      process.cwd(),
      "examples",
      "visualization-assets",
      "highmix",
      "CesiumMilkTruck.glb",
    ),
    license: "CC-BY-4.0",
    sourceUrl: "https://github.com/KhronosGroup/glTF-Sample-Models/tree/master/2.0/CesiumMilkTruck",
    description: "Transport proxy model for released/completed job movers.",
    tags: ["highmix", "transport", "truck"],
  },
  {
    requestPath: "highmix/toycar.glb",
    bundledPath: path.resolve(
      process.cwd(),
      "examples",
      "visualization-assets",
      "highmix",
      "ToyCar.glb",
    ),
    license: "CC-BY-4.0",
    sourceUrl: "https://github.com/KhronosGroup/glTF-Sample-Models/tree/master/2.0/ToyCar",
    description: "Alternate transport mover variant for lane diversity.",
    tags: ["highmix", "transport", "car"],
  },
];
