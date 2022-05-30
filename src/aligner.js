// Copyright (c) 2022 David Huggins-Daines <dhdaines@gmail.com>

var ssjs;
var recognizer = null;
const registerWebWorker = require('webworker-promise/lib/register');
registerWebWorker()
    .operation("initialize", initialize)
    .operation("align", align)

async function initialize(config) {
    ssjs = await require("soundswallower")()
    recognizer = new ssjs.Decoder(config);
    return recognizer.initialize();
}

async function align(message) {
    if (recognizer.config.get("samprate") != message.audio.sampleRate) {
	recognizer.config.set("samprate", message.audio.sampleRate);
	await recognizer.reinitialize_audio();
    }
    const transitions = [];
    let idx = 0;
    for (const word of message.text.trim().split(/\s+/)) {
	if (recognizer.lookup_word(word) === null) {
	    throw new Error("Word '"+word+"' is not in the dictionary");
	}
	transitions.push({from: idx, to: idx + 1, word: word, prob: 1.0});
	idx++;
    }
    const fsg = recognizer.create_fsg(message.text, 0, idx, transitions);
    await recognizer.set_fsg(fsg);
    fsg.delete();
    await recognizer.start();
    const nfr = await recognizer.process(message.audio.channelData[0], true);
    await recognizer.stop();
    return recognizer.get_hypseg()
}
