"use strict";
// Copyright (c) 2022 David Huggins-Daines <dhdaines@gmail.com>
// MIT license, see LICENSE for details

const decode = require("audio-decode");
const aligner = require("./aligner.js");

require("purecss");
require("./index.css");

window.addEventListener("load", initialize);

// Wait 500ms after input to run alignment
const INPUT_TIMEOUT = 500;

// FIXME: Global, but doesn't need to be
var status_bar;
function update_status(message) {
    status_bar.innerHTML = message;
}
// Currently loaded audio data
var audio_data = null;
// Decoder for alignment
var aligner_ready = false;

async function initialize() {
    status_bar = document.getElementById("status-bar");
    const text_input = document.getElementById("text-input");
    const aligned_text = document.getElementById("aligned-text");
    const file_input = document.getElementById("file-input");
    const file_play = document.getElementById("file-play");
    file_input.addEventListener("change", async () => {
        const file = file_input.files[0];
	/* Set it up to play in the audio element */
        file_play.src = URL.createObjectURL(file);
	/* Read it into an AudioBuffer for alignment purposes */
	let audio_buffer = await decode(file);
	/* But ... AudioBuffer is not transferable
	 * (https://github.com/WebAudio/web-audio-api/issues/2390) and
	 * also cannot be serialized :( */
	audio_data = {
	    sampleRate: audio_buffer.sampleRate,
	    channelData: [
		/* FIXME: Assume it's mono for now */
		audio_buffer.getChannelData(0)
	    ]
	};
    });
    let timeout = null;
    text_input.addEventListener("input", () => {
	clearTimeout(timeout);
	async function timeout_function() {
	    if (aligner === null || !aligner_ready) {
		update_status("Waiting for speech recognition...");
		setTimeout(timeout_function, INPUT_TIMEOUT);
	    }
	    else if (audio_data === null) {
		update_status("Please select a WAV file to align");
		setTimeout(timeout_function, INPUT_TIMEOUT);
	    }
	    else {
		update_status("Aligning: "+ text_input.value);
		try {
		    const hypseg = await aligner.align(audio_data,
						       text_input.value);
		    console.log(hypseg);
		    /* Build the clickable aligned text */
		    aligned_text.innerHTML = "";
		    for (const idx in hypseg) {
			const wordel = document.createElement("span");
			wordel.textContent = hypseg[idx].word;
			wordel.className = "segment pure-button";
			wordel.title = "("+hypseg[idx].start+":"+hypseg[idx].end+")";
			wordel.addEventListener("click", async () => {
			    // FIXME: Do all this with sprites or whatever
			    const duration = hypseg[idx].end - hypseg[idx].start;
			    file_play.currentTime = hypseg[idx].start;
			    await file_play.play();
			    setTimeout(() => { file_play.pause() },
				       duration * 1000);
			});
			aligned_text.appendChild(wordel);
			if (idx != hypseg.length - 1)
			    aligned_text.append(document.createTextNode(" "));
		    }
		}
		catch (e) {
		    update_status("Error aligning: " + e.message);
		}
	    }
	};
	timeout = setTimeout(timeout_function, INPUT_TIMEOUT);
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

