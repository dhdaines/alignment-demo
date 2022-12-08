// Copyright (c) 2022 David Huggins-Daines <dhdaines@gmail.com>
// MIT license, see LICENSE for details

import { AudioContext, AudioBuffer } from "standardized-audio-context";
import { debounce } from "debounce";
import * as aligner from "./aligner";

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
    file_input: HTMLInputElement;
    file_play: HTMLAudioElement;
    spectrogram: HTMLCanvasElement;
    spectrogramImage: ImageData;
    audio_buffer: AudioBuffer | null = null;
    aligner_ready = false;

    constructor() {
        this.status_bar = document.getElementById("status-bar") as HTMLElement;
        this.text_input = document.getElementById("text-input") as HTMLTextAreaElement;
        this.aligned_text = document.getElementById("aligned-text") as HTMLElement;
        this.file_input = document.getElementById("file-input") as HTMLInputElement;
        this.file_play = document.getElementById("file-play") as HTMLAudioElement;
        this.spectrogram = document.getElementById("spectrogram") as HTMLCanvasElement;
    }
    
    update_status(message: string) {
        this.status_bar.innerHTML = message;
    }

    async load_audiofile() {
        if (this.file_input.files !== null) {
            const file = this.file_input.files[0];
	    /* Set it up to play in the audio element */
            this.file_play.src = URL.createObjectURL(file);
	    /* Decode it into an AudioBuffer for alignment purposes */
            const sampleRate = aligner.recognizer.get_config("samprate") as number;
            const context = new AudioContext({ sampleRate });
            this.audio_buffer = await context.decodeAudioData(await file.arrayBuffer());
            this.draw_spectrogram();
        }
        this.text_input.value = "";
        this.align_text();
    }

    async draw_spectrogram() {
        const canvas = this.spectrogram;
        if (this.audio_buffer !== null) {
            const { data, nfr, nfeat } = await aligner.recognizer.spectrogram(
                this.audio_buffer.getChannelData(0));
            const frate = aligner.recognizer.get_config("frate") as number;
            console.log(this.audio_buffer);
            console.log(`nfr ${nfr} = ${nfr / frate} sec, nfeat ${nfeat}`);
            /* Plot it */
            canvas.width = nfr * FRAME_WIDTH;
            canvas.height = (nfeat - 1) * FILT_HEIGHT;
            const ctx = canvas.getContext("2d");
            if (ctx === null) {
                this.update_status("Failed to get canvas context");
                return;
            }
            ctx.save();
            ctx.fillStyle = "#fffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            let max_value = 0;
            for (let i = 0; i < data.length; i++)
                if (data[i] > max_value)
                    max_value = data[i];
            for (let i = 0; i < nfr; i++) {
                for (let j = 1; j < nfeat; j++) {
                    const value = data[i * nfeat + j];
                    const sv = Math.floor(value * 255 / max_value).toString(16);
                    ctx.fillStyle = "#" + sv + sv + sv;
                    /* From the bottom up */
                    const y = canvas.height - (j * FILT_HEIGHT);
                    const x = i * FRAME_WIDTH;
                    ctx.fillRect(x, y, FRAME_WIDTH, FILT_HEIGHT);
                }
            }
            ctx.restore();
            this.spectrogramImage = ctx.getImageData(0, 0, canvas.width, canvas.height);
        }
    }

    make_aligned_text(result: any) {
	/* Build the clickable aligned text */
	this.aligned_text.innerHTML = "";
	for (let idx = 0; idx < result.w.length; idx++) {
            const seg = result.w[idx];
	    const wordel = document.createElement("span");
            if (seg.t == "<s>" || seg.t == "</s>"
                || seg.t == "(null)" || seg.t == "<sil>")
                continue;
	    wordel.textContent = seg.t;
	    wordel.className = "segment pure-button";
	    wordel.title = `(${seg.b}:${seg.b+seg.d})`;
	    wordel.addEventListener("click", async () => {
		// FIXME: Do all this with sprites or whatever
		this.file_play.currentTime = seg.b;
		await this.file_play.play();
		window.setTimeout(() => { this.file_play.pause() },
				  seg.d * 1000);
	    });
	    this.aligned_text.appendChild(wordel);
	    if (idx != result.w.length - 1)
		this.aligned_text.append(document.createTextNode(" "));
	}
    }

    draw_labels(result:any) {
        const canvas = this.spectrogram;
        const ctx = canvas.getContext("2d");
        if (ctx === null) {
            this.update_status("Failed to get canvas context");
            return;
        }
        ctx.putImageData(this.spectrogramImage, 0, 0);
        ctx.save()
        ctx.strokeStyle = "red";
        ctx.fillStyle = "red";
        ctx.font = "24px sans-serif";
        ctx.textBaseline = "top";
        ctx.textAlign = "center";
        const frate = aligner.recognizer.get_config("frate") as number;
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
            ctx.strokeStyle = "green";
            ctx.fillStyle = "green";
            ctx.font = "14px sans-serif";
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
    
    async align_text() {
	if (this.audio_buffer === null) {
	    this.update_status("Please select an audio file to align");
	}
	else if (this.text_input.value.trim() == "") {
	    this.update_status("Please enter some text to align");
	}
        else {
	    this.update_status("Aligning...");
	    try {
		const result = await aligner.align(this.audio_buffer,
						   this.text_input.value);
		console.log(result);
                this.make_aligned_text(result);
                this.draw_labels(result);
                this.update_status("done!");
	    }
	    catch (e) {
		this.update_status("Error aligning: " + e.message);
	    }
	}
    }

    async initialize() {
	this.update_status("Waiting for speech recognition...");
        try {
	    await aligner.initialize({hmm: "model/en-us", /* Relative path */
				      loglevel: "INFO"});
	    this.update_status("Speech recognition ready");
	    this.aligner_ready = true;
        }
        catch (e) {
	    this.update_status("Error initializing speech aligner: "
		+ e.message);
        }
        this.file_input.addEventListener("change",
                                         () => this.load_audiofile());
        this.text_input.addEventListener("input",
                                         debounce(() => this.align_text(),
                                                  INPUT_TIMEOUT));
    }
}

window.addEventListener("load", async () => {
    const app = new DemoApp();
    app.initialize();
});
