import '@kitware/vtk.js/Rendering/Profiles/Volume';
import vtkVolume from '@kitware/vtk.js/Rendering/Core/Volume';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';

export const VERTICAL_EXAGGERATION = 3;

const encode = ({ scale, offset }, dbz) => (dbz - offset) / scale;

export function createReflectivityColors(encoding) {
  const colors = vtkColorTransferFunction.newInstance();
  for (const [dbz, red, green, blue] of [
    [20, 0.15, 0.45, 0.95],
    [30, 0.10, 0.73, 0.45],
    [40, 0.99, 0.86, 0.20],
    [50, 0.97, 0.40, 0.09],
    [60, 0.85, 0.13, 0.25],
    [70, 0.50, 0.10, 0.65],
  ]) colors.addRGBPoint(encode(encoding, dbz), red, green, blue);
  return colors;
}

export function createStormScene(renderer, imageData, metadata) {
  const colors = createReflectivityColors(metadata.encoding);
  const opacity = vtkPiecewiseFunction.newInstance();
  opacity.addPoint(metadata.encoding.missing, 0);
  for (const [dbz, alpha] of [[20, 0], [30, 0.08], [40, 0.20], [50, 0.35], [60, 0.50], [70, 0.65]]) {
    opacity.addPoint(encode(metadata.encoding, dbz), alpha);
  }

  const spacing = imageData.getSpacing();
  const sampleDistance = Math.min(spacing[0], spacing[1], spacing[2] * VERTICAL_EXAGGERATION) * 0.8;
  const mapper = vtkVolumeMapper.newInstance({ sampleDistance, autoAdjustSampleDistances: false });
  mapper.setInputData(imageData);
  const cut = vtkPlane.newInstance({ normal: [0, 1, 0] });
  mapper.addClippingPlane(cut);
  const volume = vtkVolume.newInstance();
  volume.setMapper(mapper);
  volume.setScale(1, 1, VERTICAL_EXAGGERATION);
  volume.getProperty().setRGBTransferFunction(0, colors);
  volume.getProperty().setScalarOpacity(0, opacity);
  volume.getProperty().setScalarOpacityUnitDistance(0, 1000);
  volume.getProperty().setInterpolationTypeToLinear();
  volume.getProperty().setShade(false);
  renderer.addVolume(volume);

  const setSlice = (index) => {
    const extent = imageData.getExtent();
    const slice = Math.max(extent[2], Math.min(extent[3], Math.round(index)));
    cut.setOrigin(imageData.indexToWorld([0, slice, 0]));
  };
  setSlice(0);

  return {
    setSlice,
    delete() {
      renderer.removeVolume(volume);
      volume.delete();
      mapper.delete();
      cut.delete();
      opacity.delete();
      colors.delete();
    },
  };
}
