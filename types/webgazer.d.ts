declare module 'webgazer' {
  export type GazeData = {
    x: number;
    y: number;
  };

  export type WebGazer = {
    setGazeListener: (
      listener: (data: GazeData | null, elapsedTime: number) => void,
    ) => WebGazer;
    begin: () => Promise<WebGazer>;
    showVideoPreview: (show: boolean) => WebGazer;
    showPredictionPoints: (show: boolean) => WebGazer;
    showFaceOverlay: (show: boolean) => WebGazer;
    showFaceFeedbackBox: (show: boolean) => WebGazer;
    setRegression: (name: string) => WebGazer;
  };

  const webgazer: WebGazer;
  export default webgazer;
}
