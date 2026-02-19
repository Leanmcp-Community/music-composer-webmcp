declare module "soundfont-player" {
  interface PlayOptions {
    gain?: number;
    attack?: number;
    decay?: number;
    sustain?: number;
    release?: number;
    duration?: number;
    loop?: boolean;
  }

  interface SoundfontPlayer {
    play(note: string | number, when?: number, options?: PlayOptions): AudioBufferSourceNode;
    stop(when?: number): void;
    connect(destination: AudioNode): SoundfontPlayer;
    disconnect(): SoundfontPlayer;
    schedule(when: number, events: Array<{ time: number; note: string | number; options?: PlayOptions }>): void;
  }

  interface InstrumentOptions {
    soundfont?: "MusyngKite" | "FluidR3_GM" | "FatBoy";
    format?: "mp3" | "ogg";
    nameToUrl?: (name: string, soundfont: string, format: string) => string;
    destination?: AudioNode;
    audioContext?: AudioContext | OfflineAudioContext;
    gain?: number;
  }

  function instrument(
    audioContext: AudioContext | OfflineAudioContext,
    name: string,
    options?: InstrumentOptions
  ): Promise<SoundfontPlayer>;

  export { instrument };
  export default { instrument };
}
