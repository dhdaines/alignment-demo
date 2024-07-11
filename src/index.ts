// -*- js-indent-level: 2 -*-
// Copyright (c) 2022 David Huggins-Daines <dhd@ecolingui.ca>
// MIT license, see LICENSE for details

import { AudioContext, AudioBuffer } from "standardized-audio-context";
import { debounce } from "debounce";
import { Aligner, Segment } from "./aligner";

require("purecss");
require("./index.css");

// Debounce text input for 500ms
const INPUT_TIMEOUT = 500;

// Width of frames in spectrogram
const FRAME_WIDTH = 5;
// Height of frequency bins in spectrogram
const FILT_HEIGHT = 10;

class DemoApp {
  status_bar: HTMLElement;
  text_input: HTMLTextAreaElement;
  aligned_text: HTMLElement;
  download: HTMLElement;
  download_audio: HTMLElement;
  download_alignment: HTMLElement;
  file_input: HTMLInputElement;
  file_play: HTMLAudioElement;
  start_button: HTMLButtonElement;
  stop_button: HTMLButtonElement;
  language_list: HTMLSelectElement;
  spectrogram: HTMLCanvasElement;
  spectrogramImage: ImageData;
  recorder: MediaRecorder | null = null;
  chunks: Array<Blob> = [];
  audio_buffer: AudioBuffer | null = null;
  aligner: Aligner;

  constructor() {
    this.status_bar = document.getElementById("status-bar") as HTMLElement;
    this.text_input = document.getElementById(
      "text-input"
    ) as HTMLTextAreaElement;
    this.download = document.getElementById("download") as HTMLElement;
    this.download_audio = document.getElementById("download_audio") as HTMLElement;
    this.download_alignment = document.getElementById("download_alignment") as HTMLElement;
    this.aligned_text = document.getElementById("aligned-text") as HTMLElement;
    this.file_input = document.getElementById("file-input") as HTMLInputElement;
    this.file_play = document.getElementById("file-play") as HTMLAudioElement;
    this.start_button = document.getElementById("record") as HTMLButtonElement;
    this.stop_button = document.getElementById("stop") as HTMLButtonElement;
    this.language_list = document.getElementById(
      "language"
    ) as HTMLSelectElement;
    this.spectrogram = document.getElementById(
      "spectrogram"
    ) as HTMLCanvasElement;
    this.aligner = new Aligner();
  }

  update_status(message: string) {
    this.status_bar.innerHTML = message;
  }

  async load_audiofile(audio_file: File | Blob) {
    /* Set it up to play in the audio element */
    if (this.file_play.src)
      URL.revokeObjectURL(this.file_play.src);
    this.file_play.src = URL.createObjectURL(audio_file);
    this.download_audio.setAttribute("href", this.file_play.src)
    this.download_audio.classList.remove("hidden");
    this.download.classList.remove("hidden");
    /* Decode it into an AudioBuffer for alignment purposes */
    const sampleRate = this.aligner.recognizer.get_config("samprate") as number;
    const context = new AudioContext({ sampleRate });
    this.audio_buffer = await context.decodeAudioData(
      await audio_file.arrayBuffer()
    );
    this.draw_spectrogram();
    this.text_input.value = "";
    this.aligned_text.innerHTML = "";
    // No more alignment to download!
    this.download_alignment.classList.add("hidden");
    this.align_text();
  }

  async draw_spectrogram() {
    const canvas = this.spectrogram;
    if (this.audio_buffer !== null) {
      const { data, nfr, nfeat } = this.aligner.recognizer.spectrogram(
        this.audio_buffer.getChannelData(0)
      );
      /* Plot it */
      canvas.height = (nfeat - 1) * FILT_HEIGHT + 60;
      canvas.width = nfr * FRAME_WIDTH;
      const ctx = canvas.getContext("2d");
      if (ctx === null) {
        this.update_status("Failed to get canvas context");
        return;
      }
      ctx.save();
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      let max_value = 0;
      for (let i = 0; i < data.length; i++)
        if (data[i] > max_value) max_value = data[i];
      for (let i = 0; i < nfr; i++) {
        for (let j = 1; j < nfeat; j++) {
          /* They *should* be positive, it's a *log* spectrum, but... */
          const value = Math.abs(data[i * nfeat + j]);
          const sv = Math.floor((value * 255) / max_value).toString(16);
          ctx.fillStyle = "#" + sv + sv + sv;
          /* From the bottom up */
          const y = canvas.height - j * FILT_HEIGHT;
          const x = i * FRAME_WIDTH;
          ctx.fillRect(x, y, FRAME_WIDTH, FILT_HEIGHT);
        }
      }
      ctx.restore();
      this.spectrogramImage = ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      );
    }
  }

  make_aligned_text(result: any) {
    /* Build the clickable aligned text */
    this.aligned_text.innerHTML = "";
    for (let idx = 0; idx < result.w.length; idx++) {
      const seg = result.w[idx];
      const wordel = document.createElement("span");
      if (
        seg.t == "<s>" ||
        seg.t == "</s>" ||
        seg.t == "(null)" ||
        seg.t == "<sil>"
      )
        continue;
      wordel.textContent = seg.t;
      wordel.className = "segment pure-button";
      wordel.title = `(${seg.b}:${seg.b + seg.d})`;
      wordel.addEventListener("click", async () => {
        // FIXME: Do all this with sprites or whatever
        this.file_play.currentTime = seg.b;
        await this.file_play.play();
        window.setTimeout(() => {
          this.file_play.pause();
        }, seg.d * 1000);
      });
      this.aligned_text.appendChild(wordel);
      if (idx != result.w.length - 1)
        this.aligned_text.append(document.createTextNode(" "));
    }
  }

  draw_labels(result: any) {
    const canvas = this.spectrogram;
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      this.update_status("Failed to get canvas context");
      return;
    }
    ctx.putImageData(this.spectrogramImage, 0, 0);
    ctx.save();
    ctx.font = "24px sans-serif";
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    const frate = this.aligner.recognizer.get_config("frate") as number;
    for (const { t, b, d, w } of result.w) {
      const x_start = Math.round(b * frate * FRAME_WIDTH);
      const x_width = Math.round(d * frate * FRAME_WIDTH);
      if (x_start != 0) {
        ctx.beginPath();
        ctx.moveTo(x_start, 0);
        ctx.lineTo(x_start, canvas.height);
        ctx.stroke();
      }
      ctx.fillText(t, x_start + x_width / 2, 5);
      ctx.save();
      ctx.font = "18px sans-serif";
      const word_x_start = x_start;
      for (const { t, b, d } of w) {
        const x_start = Math.round(b * frate * FRAME_WIDTH);
        const x_width = Math.round(d * frate * FRAME_WIDTH);
        ctx.fillText(t, x_start + x_width / 2, 40);
        if (x_start != word_x_start) {
          ctx.beginPath();
          ctx.moveTo(x_start, 40);
          ctx.lineTo(x_start, canvas.height);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * Create download link for alignment (audio done elsewhere).
   */
  make_alignment_download(result: Segment) {
    const data = URL.createObjectURL(
      new Blob([JSON.stringify(result, null, 2)], {
        type: "application/json"
      })
    );
    const prev_data = this.download_alignment.getAttribute("href");
    if (prev_data)
      URL.revokeObjectURL(prev_data);
    this.download_alignment.setAttribute("href", data);
    this.download_alignment.classList.remove("hidden");
    this.download.classList.remove("hidden");
  }

  async align_text() {
    if (this.audio_buffer === null) {
      this.update_status("Please record or select an audio file to align");
    } else if (this.text_input.value.trim() == "") {
      this.update_status("Please enter some text to align");
    } else {
      this.update_status("Aligning...");
      try {
        const result = await this.aligner.align(
          this.audio_buffer,
          this.text_input.value
        );
        this.make_alignment_download(result);
        this.make_aligned_text(result);
        this.draw_labels(result);
        this.update_status("done!");
      } catch (e) {
        this.update_status("Error aligning: " + e.message);
        throw e;
      }
    }
  }

  async create_recorder() {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
    } catch (err) {
      this.update_status("Failed to get media stream for microphone" + err);
      return null;
    }
    // Try to find a MIME type supported by your (Apple's) stupid browser
    const types = [
      "audio/webm;codecs=opus",
      "audio/mpeg",
      "audio/mp4",
      "audio/wav",
    ];
    let mimeType: string | null = null;
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        mimeType = type;
        break;
      }
    }
    if (mimeType === null) {
      alert("Your browser doesn't support any kind of audio recording!");
      this.start_button.disabled = true;
      return null;
    }
    const recorder = new MediaRecorder(stream, {
      mimeType
    });
    recorder.ondataavailable = (event: BlobEvent) => {
      this.chunks.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(this.chunks, { type: mimeType || undefined });
      this.chunks = [];
      this.load_audiofile(blob);
    };
    return recorder;
  }

  async start_recording() {
    if (this.recorder === null) {
      this.recorder = await this.create_recorder();
      if (this.recorder === null) {
        this.start_button.disabled = true;
        this.stop_button.disabled = true;
        return true;
      }
    }
    this.start_button.disabled = true;
    this.stop_button.disabled = false;
    this.recorder.start();
    return true;
  }

  async stop_recording() {
    if (this.recorder !== null) {
      this.recorder.stop();
      this.start_button.disabled = false;
      this.stop_button.disabled = true;
    }
    return true;
  }

  async init_aligner() {
    await this.aligner.initialize();
    const nfeat = this.aligner.recognizer.get_config("nfilt") as number;
    this.spectrogram.height = (nfeat - 1) * FILT_HEIGHT + 60;
  }

  async initialize() {
    this.update_status("Waiting for speech recognition...");
    try {
      await this.init_aligner();
    } catch (e) {
      this.update_status("Error initializing speech aligner: " + e.message);
      return;
    }
    this.language_list.innerHTML = "";
    for (const {code, name} of this.aligner.langs) {
      const opt = document.createElement("option");
      opt.value = code;
      opt.text = `${name} (${code})`;
      if (code == this.aligner.lang)
        opt.selected = true;
      this.language_list.add(opt);
    }
    this.update_status("Speech recognition ready");
    this.start_button.addEventListener("click", () => this.start_recording());
    this.start_button.disabled = false;
    this.stop_button.addEventListener("click", () => this.stop_recording());
    this.file_input.addEventListener("change", () => {
      if (this.file_input.files !== null)
        this.load_audiofile(this.file_input.files[0]);
    });
    this.text_input.addEventListener(
      "input",
      debounce(() => this.align_text(), INPUT_TIMEOUT)
    );
    this.language_list.addEventListener("change", async () => {
      const idx = this.language_list.selectedIndex;
      this.aligner.lang = this.language_list.options[idx].value;
      this.text_input.value = "";
      this.aligned_text.innerHTML = "";
      this.align_text();
    });
  }
}

window.addEventListener("load", async () => {
  const app = new DemoApp();
  app.initialize();
});
