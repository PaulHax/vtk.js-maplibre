import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';
import vtkImageMapper from '@kitware/vtk.js/Rendering/Core/ImageMapper';
import vtkImageSlice from '@kitware/vtk.js/Rendering/Core/ImageSlice';
import { createReflectivityColors, VERTICAL_EXAGGERATION } from './stormScene.js';

export function createStormSlice(container, imageData, metadata) {
  const view = vtkGenericRenderWindow.newInstance({ background: [0.08, 0.12, 0.17] });
  view.setContainer(container);
  const interactor = view.getInteractor();
  interactor.unbindEvents(container);
  const renderWindow = view.getRenderWindow();
  const renderer = view.getRenderer();
  const mapper = vtkImageMapper.newInstance();
  mapper.setInputData(imageData);
  mapper.setJSlice(0);
  const actor = vtkImageSlice.newInstance();
  actor.setMapper(mapper);
  actor.setScale(1, 1, VERTICAL_EXAGGERATION);
  const colors = createReflectivityColors(metadata.encoding);
  colors.addRGBPoint(0, 0.08, 0.12, 0.17);
  actor.getProperty().setRGBTransferFunction(0, colors);
  actor.getProperty().setUseLookupTableScalarRange(true);
  actor.getProperty().setInterpolationTypeToNearest();
  renderer.addActor(actor);
  const camera = renderer.getActiveCamera();
  const bounds = actor.getBounds();
  const x = (bounds[0] + bounds[1]) / 2;
  const z = (bounds[4] + bounds[5]) / 2;
  camera.setParallelProjection(true);
  camera.setPosition(x, bounds[2] - 200000, z);
  camera.setFocalPoint(x, bounds[2], z);
  camera.setViewUp(0, 0, 1);
  const resize = view.onResize(() => {
    const aspect = container.clientWidth / container.clientHeight;
    camera.setParallelScale(Math.max(bounds[5] - bounds[4], (bounds[1] - bounds[0]) / aspect) * 0.53);
    renderer.resetCameraClippingRange();
  });
  view.resize();

  return {
    setSlice(index) {
      mapper.setJSlice(index);
      renderer.resetCameraClippingRange();
      renderWindow.render();
    },
    resize: () => view.resize(),
    delete() {
      resize.unsubscribe();
      renderer.removeActor(actor);
      view.delete();
      actor.delete();
      mapper.delete();
      colors.delete();
      interactor.delete();
      renderer.delete();
      renderWindow.delete();
    },
  };
}
