"use strict";
// Copyright (c) 2022 David Huggins-Daines <dhdaines@gmail.com>

var ssjs;
var recognizer = null;

async function initialize(config) {
    ssjs = await require("soundswallower")()
    recognizer = new ssjs.Decoder(config);
    return recognizer.initialize();
}

async function align(audio, text) {
    if (recognizer.get_config("samprate") != audio.sampleRate) {
	recognizer.set_config("samprate", audio.sampleRate);
	await recognizer.reinitialize_audio();
    }
    await recognizer.set_align_text(text);
    await recognizer.start();
    console.log(audio);
    const nfr = await recognizer.process(audio.channelData[0], false, true);
    await recognizer.stop();
    const jresult = await recognizer.get_alignment_json(0, 0);
    return JSON.parse(jresult);
}

module.exports = {
    initialize: initialize,
    align: align,
};
