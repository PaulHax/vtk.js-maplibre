import '@kitware/vtk.js/Rendering/Profiles/Geometry';
import '@kitware/vtk.js/Rendering/Profiles/Glyph';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkGlyph3DMapper from '@kitware/vtk.js/Rendering/Core/Glyph3DMapper';
import vtkCylinderSource from '@kitware/vtk.js/Filters/Sources/CylinderSource';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { MercatorCoordinate } from 'maplibre-gl';

const origin = MercatorCoordinate.fromLngLat([0, 0]);
const equatorialScale = origin.meterInMercatorCoordinateUnits();
const clamp = (value) => Math.max(0, Math.min(1, value));
const mixColor = (start, end, value) => start.map((channel, index) => Math.round(channel + (end[index] - channel) * clamp(value)));
const bikeHeight = (item) => Math.max(1, item.bikes * 4);

export const bikeAltitude = (item) => bikeHeight(item) / 2;

export function createBikeScene(renderer) {
  const cylinder = vtkCylinderSource.newInstance({ radius: 1, height: 1, direction: [0, 0, 1], resolution: 16, capping: true });
  const data = vtkPolyData.newInstance();
  const scales = vtkDataArray.newInstance({ name: 'Glyph scale', numberOfComponents: 3, values: new Float32Array(0) });
  const colors = vtkDataArray.newInstance({ name: 'Glyph color', numberOfComponents: 3, values: new Uint8Array(0) });
  data.getPointData().addArray(scales);
  data.getPointData().setScalars(colors);
  const mapper = vtkGlyph3DMapper.newInstance({ orient: false, scaleArray: 'Glyph scale' });
  mapper.setScaleModeToScaleByComponents();
  mapper.setColorModeToDirectScalars();
  mapper.setScalarModeToUsePointData();
  mapper.setInputData(data);
  mapper.setSourceConnection(cylinder.getOutputPort());
  const actor = vtkActor.newInstance();
  actor.setMapper(mapper);
  actor.getProperty().setAmbient(0.35);
  actor.getProperty().setDiffuse(0.65);
  actor.getProperty().setSpecular(0.15);
  actor.getProperty().setSpecularPower(20);
  actor.setVisibility(false);
  renderer.addActor(actor);

  return {
    setData(items) {
      const positions = new Float64Array(items.length * 3);
      const dimensions = new Float32Array(items.length * 3);
      const rgb = new Uint8Array(items.length * 3);
      items.forEach((item, index) => {
        const coordinate = MercatorCoordinate.fromLngLat([item.longitude, item.latitude]);
        const latitudeScale = coordinate.meterInMercatorCoordinateUnits() / equatorialScale;
        positions.set([
          (coordinate.x - origin.x) / equatorialScale,
          (origin.y - coordinate.y) / equatorialScale,
          bikeAltitude(item) * latitudeScale,
        ], index * 3);
        dimensions.set([12 * latitudeScale, 12 * latitudeScale, bikeHeight(item) * latitudeScale], index * 3);
        rgb.set(mixColor([242, 143, 53], [17, 167, 155], item.capacity > 0 ? item.bikes / item.capacity : 0), index * 3);
      });
      data.getPoints().setData(positions, 3);
      scales.setData(dimensions, 3);
      colors.setData(rgb, 3);
      data.modified();
      actor.setVisibility(items.length > 0);
    },
    delete() {
      renderer.removeActor(actor);
      actor.delete();
      mapper.delete();
      data.delete();
      scales.delete();
      colors.delete();
      cylinder.delete();
    },
  };
}
