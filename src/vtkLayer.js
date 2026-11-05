import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';
import vtkRenderWindowInteractor from '@kitware/vtk.js/Rendering/Core/RenderWindowInteractor';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import { mat4 } from 'gl-matrix';

// MapLibre resets its tracked GL state around custom layers. These values
// establish the state vtk.js expects without clearing the host attachments.
function prepareGL(gl) {
  gl.bindVertexArray(null);
  gl.useProgram(null);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.STENCIL_TEST);
  gl.disable(gl.POLYGON_OFFSET_FILL);
  gl.disable(gl.SCISSOR_TEST);
  gl.disable(gl.RASTERIZER_DISCARD);
  gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
  gl.disable(gl.SAMPLE_COVERAGE);
  gl.colorMask(true, true, true, true);
  gl.depthMask(true);
  gl.depthFunc(gl.LEQUAL);
  // Preserve MapLibre's depth range; it reserves separate bands for 2D layers.
  gl.frontFace(gl.CCW);
  gl.blendEquation(gl.FUNC_ADD);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.enable(gl.BLEND);
  gl.enable(gl.DEPTH_TEST);
  gl.activeTexture(gl.TEXTURE0);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
}

export function createVtkLayer({ origin, createScene, onReady, onRendered, volumeRendering = false }) {
  const scale = origin.meterInMercatorCoordinateUnits();
  const model = new Float64Array([scale, 0, 0, 0, 0, -scale, 0, 0, 0, 0, scale, 0, origin.x, origin.y, origin.z, 1]);
  let renderWindow;
  let renderer;
  let view;
  let scene;
  let interactor;
  let firstFrame = true;
  let projection;
  let canvas;

  return {
    id: 'vtk-observations',
    type: 'custom',
    renderingMode: '3d',
    onAdd(map, gl) {
      canvas = map.getCanvas();
      if (!(gl instanceof WebGL2RenderingContext)) throw new Error('This example requires WebGL2.');
      renderWindow = vtkRenderWindow.newInstance();
      renderer = vtkRenderer.newInstance({ preserveColorBuffer: true, preserveDepthBuffer: true });
      renderWindow.addRenderer(renderer);
      view = vtkOpenGLRenderWindow.newInstance({ canvas: map.getCanvas(), manageCanvas: false });
      renderWindow.addView(view);
      // Initializing against the host canvas obtains its existing WebGL2 context.
      view.initialize();
      if (volumeRendering) {
        interactor = vtkRenderWindowInteractor.newInstance();
        interactor.setView(view);
        interactor.setEnabled(true);
      }
      scene = createScene(renderer);
      onReady(scene);
    },
    render(gl, args) {
      projection = args.defaultProjectionData.mainMatrix;
      const combined = new Float64Array(16);
      const inverseProjection = new Float64Array(16);
      const cameraView = new Float64Array(16);
      mat4.multiply(combined, args.defaultProjectionData.mainMatrix, model);
      mat4.invert(inverseProjection, args.projectionMatrix);
      mat4.multiply(cameraView, inverseProjection, combined);
      const camera = renderer.getActiveCamera();
      const cameraProjection = new Float64Array(args.projectionMatrix);
      if (volumeRendering) {
        // Volume sampling and clipping use meters. Move the uniform map-view
        // scale into the projection so the view matrix remains a rigid transform.
        const viewScale = Math.hypot(cameraView[0], cameraView[1], cameraView[2]);
        for (const index of [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14]) cameraView[index] /= viewScale;
        for (const index of [12, 13, 14, 15]) cameraProjection[index] /= viewScale;
        camera.setClippingRange(
          cameraProjection[14] / (cameraProjection[10] - 1),
          cameraProjection[14] / (cameraProjection[10] + 1),
        );
      }
      camera.setViewMatrix(cameraView);
      camera.setExplicitProjectionMatrix(cameraProjection);
      camera.modified();
      view.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight);
      const frontFace = gl.getParameter(gl.FRONT_FACE);
      try {
        prepareGL(gl);
        view.getShaderCache().setLastShaderProgramBound(null);
        renderWindow.render();
        if (firstFrame) {
          firstFrame = false;
          onRendered();
        }
      } finally {
        view.getShaderCache().setLastShaderProgramBound(null);
        gl.frontFace(frontFace);
        gl.bindVertexArray(null);
      }
    },
    projectMercator(point) {
      if (!projection) return null;
      const { x, y, z } = point;
      const w = projection[3] * x + projection[7] * y + projection[11] * z + projection[15];
      if (w <= 0) return null;
      const px = (projection[0] * x + projection[4] * y + projection[8] * z + projection[12]) / w;
      const py = (projection[1] * x + projection[5] * y + projection[9] * z + projection[13]) / w;
      return { x: (px + 1) * canvas.clientWidth / 2, y: (1 - py) * canvas.clientHeight / 2 };
    },
    onRemove() {
      view.delete();
      scene.delete();
      renderer.delete();
      interactor?.delete();
      renderWindow.delete();
    },
  };
}
