// -*- js-indent-level: 2 -*-
// Copyright (c) 2024 David Huggins-Daines <dhd@ecolingui.ca>

import { Segment } from "soundswallower/jsonly";
export { Segment };

/**
 * Minimal creation of TextGrid from Segment (should go in
 * SoundSwallower, soon, in an enhanced version)
 */
export function from_segment(seg: Segment): string {
    const words = [];
    const phones = [];
    words.push(`        intervals: size = ${seg.w!.length ?? 0}`)
    let pi = 1;
    let wi = 1;
    for (const w of seg.w!) {
        words.push(`        intervals [${wi}]:
            xmin = ${w.b}
            xmax = ${w.b + w.d}
            text = "${w.t}"`);
        for (const p of w!.w!) {
            phones.push(`        intervals [${pi}]:
            xmin = ${p.b}
            xmax = ${p.b + p.d}
            text = "${p.t}"`);
            pi++;
        }
        wi++;
    }
    phones.unshift(`        intervals: size = ${pi - 1}`)
    return `File type = "ooTextFile"
Object class = "TextGrid"

xmin = ${seg.b}
xmax = ${seg.d}
tiers? <exists>
size = 3
item []:
    item [1]:
        class = "IntervalTier"
        name = "Sentence"
        xmin = ${seg.b}
        xmax = ${seg.d}
        intervals: size = 1
        intervals [1]:
            xmin = ${seg.b}
            xmax = ${seg.d}
            text = "${seg.t}"
    item [2]:
        class = "IntervalTier"
        name = "Word"
        xmin = ${seg.b}
        xmax = ${seg.d}
${words.join('\n')}
    item [3]:
        class = "IntervalTier"
        name = "Phone"
        xmin = ${seg.b}
        xmax = ${seg.d}
${phones.join('\n')}
`    
}
