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
    if (recognizer.config.get("samprate") != audio.sampleRate) {
	recognizer.config.set("samprate", audio.sampleRate);
	await recognizer.reinitialize_audio();
    }
    const transitions = [];
    let idx = 0;
    for (const word of text.trim().split(/\s+/)) {
	if (recognizer.lookup_word(word) === null) {
	    throw new Error("Word '"+word+"' is not in the dictionary");
	}
	transitions.push({from: idx, to: idx + 1, word: word, prob: 1.0});
	idx++;
    }
    const fsg = recognizer.create_fsg(text, 0, idx, transitions);
    await recognizer.set_fsg(fsg);
    fsg.delete();
    await recognizer.start();
    const nfr = await recognizer.process(audio.channelData[0], true);
    await recognizer.stop();
    return recognizer.get_hypseg()
}

module.exports = {
    initialize: initialize,
    align: align,
};
