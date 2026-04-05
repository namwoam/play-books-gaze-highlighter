import * as faceMeshModule from '@mediapipe/face_mesh/face_mesh.js';

type FaceMeshCtor = new (...args: unknown[]) => unknown;
type FaceMeshOptions = {
  locateFile?: (file: string, basePath?: string) => string;
} & Record<string, unknown>;

const MEDIAPIPE_CDN_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/';

const moduleRef = (faceMeshModule ?? {}) as Record<string, unknown>;
const moduleExports = (moduleRef['module.exports'] ?? moduleRef) as Record<string, unknown>;
const moduleDefault = (moduleRef.default ?? {}) as Record<string, unknown>;
const globalRef =
  ((globalThis as unknown as Record<string, unknown> | undefined) ??
    (typeof self !== 'undefined' ? (self as unknown as Record<string, unknown>) : undefined) ??
    (typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : undefined) ??
    {}) as Record<string, unknown>;

const resolvedFaceMesh =
  ((moduleExports.FaceMesh as FaceMeshCtor | undefined) ??
    (moduleRef.FaceMesh as FaceMeshCtor | undefined) ??
    (moduleDefault.FaceMesh as FaceMeshCtor | undefined) ??
    (globalRef.FaceMesh as FaceMeshCtor | undefined)) ??
  null;

const cdnLocateFile = (file: string) => `${MEDIAPIPE_CDN_BASE}${file}`;

const shouldForceCdn = (url: string) => {
  if (!url) {
    return true;
  }

  if (!/^https?:\/\//i.test(url)) {
    return true;
  }

  // Play Books paths return HTML/404 for MediaPipe assets in content-script context.
  if (
    /^https?:\/\/(play\.google\.com|books\.googleusercontent\.com)\/books\/mediapipe\//i.test(
      url,
    )
  ) {
    return true;
  }

  return false;
};

export const FaceMesh: FaceMeshCtor = class FaceMeshWithLocateFile {
  constructor(options?: FaceMeshOptions) {
    if (!resolvedFaceMesh) {
      throw new Error('MediaPipe FaceMesh constructor is not available');
    }

    const userLocateFile = options?.locateFile;
    const locateFile = (file: string, basePath?: string) => {
      const candidate = userLocateFile?.(file, basePath) ?? '';
      return shouldForceCdn(candidate) ? cdnLocateFile(file) : candidate;
    };

    const finalOptions: FaceMeshOptions = {
      ...(options ?? {}),
      locateFile,
    };

    return new resolvedFaceMesh(finalOptions) as unknown as FaceMeshWithLocateFile;
  }
} as unknown as FaceMeshCtor;

export const FACEMESH_LIPS =
  moduleExports.FACEMESH_LIPS ?? moduleDefault.FACEMESH_LIPS ?? globalRef.FACEMESH_LIPS;
export const FACEMESH_LEFT_EYE =
  moduleExports.FACEMESH_LEFT_EYE ?? moduleDefault.FACEMESH_LEFT_EYE ?? globalRef.FACEMESH_LEFT_EYE;
export const FACEMESH_LEFT_EYEBROW =
  moduleExports.FACEMESH_LEFT_EYEBROW ??
  moduleDefault.FACEMESH_LEFT_EYEBROW ??
  globalRef.FACEMESH_LEFT_EYEBROW;
export const FACEMESH_LEFT_IRIS =
  moduleExports.FACEMESH_LEFT_IRIS ?? moduleDefault.FACEMESH_LEFT_IRIS ?? globalRef.FACEMESH_LEFT_IRIS;
export const FACEMESH_RIGHT_EYE =
  moduleExports.FACEMESH_RIGHT_EYE ??
  moduleDefault.FACEMESH_RIGHT_EYE ??
  globalRef.FACEMESH_RIGHT_EYE;
export const FACEMESH_RIGHT_EYEBROW =
  moduleExports.FACEMESH_RIGHT_EYEBROW ??
  moduleDefault.FACEMESH_RIGHT_EYEBROW ??
  globalRef.FACEMESH_RIGHT_EYEBROW;
export const FACEMESH_RIGHT_IRIS =
  moduleExports.FACEMESH_RIGHT_IRIS ??
  moduleDefault.FACEMESH_RIGHT_IRIS ??
  globalRef.FACEMESH_RIGHT_IRIS;
export const FACEMESH_FACE_OVAL =
  moduleExports.FACEMESH_FACE_OVAL ??
  moduleDefault.FACEMESH_FACE_OVAL ??
  globalRef.FACEMESH_FACE_OVAL;
export const FACEMESH_CONTOURS =
  moduleExports.FACEMESH_CONTOURS ??
  moduleDefault.FACEMESH_CONTOURS ??
  globalRef.FACEMESH_CONTOURS;
export const FACEMESH_TESSELATION =
  moduleExports.FACEMESH_TESSELATION ??
  moduleDefault.FACEMESH_TESSELATION ??
  globalRef.FACEMESH_TESSELATION;
