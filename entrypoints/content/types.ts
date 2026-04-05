export type SentenceRange = {
  id: number;
  range: Range;
  rect: DOMRect;
  text: string;
};

export type WebGazerPoint = {
  x: number;
  y: number;
};

export type FaceMeshPoint = [number, number, number?];

export type FaceTrackerLike = {
  name?: string;
  getPositions?: () => FaceMeshPoint[] | null;
};

export type WebGazerLike = {
  setGazeListener: (
    listener: (data: WebGazerPoint | null, elapsedTime: number) => void,
  ) => WebGazerLike;
  begin: (onNoStream?: () => void) => Promise<WebGazerLike>;
  addMouseEventListeners: () => WebGazerLike;
  recordScreenPosition: (x: number, y: number, eventType?: string) => WebGazerLike;
  applyKalmanFilter: (enabled: boolean) => WebGazerLike;
  saveDataAcrossSessions: (enabled: boolean) => WebGazerLike;
  setTracker: (name: string) => WebGazerLike;
  showVideoPreview: (show: boolean) => WebGazerLike;
  showVideo: (show: boolean) => WebGazerLike;
  showPredictionPoints: (show: boolean) => WebGazerLike;
  showFaceOverlay: (show: boolean) => WebGazerLike;
  showFaceFeedbackBox: (show: boolean) => WebGazerLike;
  setRegression: (name: string) => WebGazerLike;
  getTracker?: () => FaceTrackerLike;
  getCurrentPrediction?: () => Promise<WebGazerPoint | null> | WebGazerPoint | null;
  clearData?: () => Promise<void>;
};

export type AxisKalmanState = {
  estimate: number;
  covariance: number;
  initialized: boolean;
};
