// Copyright (c) 2022 David Huggins-Daines <dhdaines@gmail.com>
// MIT license, see LICENSE for details

import { AudioContext, AudioBuffer } from "standardized-audio-context";
import * as aligner from "./aligner";

require("purecss");
require("./index.css");

window.addEventListener("load", initialize);

// Wait 500ms after input to run alignment
const INPUT_TIMEOUT = 500;

// FIXME: Global, but doesn't need to be
var status_bar: HTMLElement | null;
function update_status(message: string) {
    if (status_bar !== null)
        status_bar.innerHTML = message;
}
// Currently loaded audio data
var audio_buffer: AudioBuffer | null = null;
// Decoder for alignment
var aligner_ready = false;

async function initialize() {
    status_bar = document.getElementById("status-bar");
    const text_input = document.getElementById("text-input") as HTMLTextAreaElement;
    const aligned_text = document.getElementById("aligned-text");
    const file_input = document.getElementById("file-input") as HTMLInputElement;
    const file_play = document.getElementById("file-play") as HTMLAudioElement;
    file_input.addEventListener("change", async () => {
        if (file_input.files !== null) {
            const file = file_input.files[0];
	    /* Set it up to play in the audio element */
            file_play.src = URL.createObjectURL(file);
	    /* Decode it into an AudioBuffer for alignment purposes */
            const sampleRate = aligner.recognizer.get_config("samprate") as number;
            const context = new AudioContext({ sampleRate });
            audio_buffer = await context.decodeAudioData(await file.arrayBuffer());
        }
    });
    let timeout: number;
    text_input.addEventListener("input", () => {
	clearTimeout(timeout);
	async function timeout_function() {
	    if (!aligner_ready) {
		update_status("Waiting for speech recognition...");
		window.setTimeout(timeout_function, INPUT_TIMEOUT);
	    }
	    else if (audio_buffer === null) {
		update_status("Please select a WAV file to align");
		window.setTimeout(timeout_function, INPUT_TIMEOUT);
	    }
	    else {
                if (aligned_text === null)
                    return;
		update_status("Aligning: "+ text_input.value);
		try {
		    const result = await aligner.align(audio_buffer,
						       text_input.value);
		    console.log(result);
		    /* Build the clickable aligned text */
		    aligned_text.innerHTML = "";
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
			    file_play.currentTime = seg.b;
			    await file_play.play();
			    window.setTimeout(() => { file_play.pause() },
				              seg.d * 1000);
			});
			aligned_text.appendChild(wordel);
			if (idx != result.w.length - 1)
			    aligned_text.append(document.createTextNode(" "));
		    }
		}
		catch (e) {
		    update_status("Error aligning: " + e.message);
		}
	    }
	};
	timeout = window.setTimeout(timeout_function, INPUT_TIMEOUT);
    });
    try {
	await aligner.initialize({hmm: "model/en-us", /* Relative path */
				  loglevel: "INFO"});
	update_status("Speech recognition ready");
	aligner_ready = true;
    }
    catch (e) {
	update_status("Error initializing speech aligner: "
		      + e.message);
    }
};

