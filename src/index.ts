// Copyright (c) 2022 David Huggins-Daines <dhdaines@gmail.com>
// MIT license, see LICENSE for details

import { AudioContext, AudioBuffer } from "standardized-audio-context";
import { debounce } from "debounce";
import * as aligner from "./aligner";

require("purecss");
require("./index.css");

// Debounce text input for 500ms
const INPUT_TIMEOUT = 500;

class DemoApp {
    status_bar: HTMLElement;
    text_input: HTMLTextAreaElement;
    aligned_text: HTMLElement;
    file_input: HTMLInputElement;
    file_play: HTMLAudioElement;
    audio_buffer: AudioBuffer | null = null;
    aligner_ready = false;

    constructor() {
        this.status_bar = document.getElementById("status-bar") as HTMLElement;
        this.text_input = document.getElementById("text-input") as HTMLTextAreaElement;
        this.aligned_text = document.getElementById("aligned-text") as HTMLElement;
        this.file_input = document.getElementById("file-input") as HTMLInputElement;
        this.file_play = document.getElementById("file-play") as HTMLAudioElement;
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
        }
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
