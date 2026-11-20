export interface WebGLSupport {
  supported: boolean;
  version: 0 | 1 | 2;
  renderer: string;
  vendor: string;
  maxTextureSize: number;
  reason?: string;
}

/** Testa WebGL num canvas descartável, antes de criar o renderer do Three.js. */
export function detectWebGL(): WebGLSupport {
  const canvas = document.createElement('canvas');
  const attrs: WebGLContextAttributes = { failIfMajorPerformanceCaveat: false };

  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  let version: 0 | 1 | 2 = 0;
  try {
    gl = canvas.getContext('webgl2', attrs);
    if (gl) version = 2;
    else {
      gl = (canvas.getContext('webgl', attrs) ??
        canvas.getContext('experimental-webgl', attrs)) as WebGLRenderingContext | null;
      if (gl) version = 1;
    }
  } catch {
    gl = null;
  }

  if (!gl) {
    return {
      supported: false,
      version: 0,
      renderer: 'n/d',
      vendor: 'n/d',
      maxTextureSize: 0,
      reason: window.WebGLRenderingContext
        ? 'O navegador conhece WebGL, mas a GPU/driver recusou criar o contexto.'
        : 'Este navegador não suporta WebGL.',
    };
  }

  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const info: WebGLSupport = {
    supported: true,
    version,
    renderer: String(debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
    vendor: String(debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)),
    maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
  };
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return info;
}
