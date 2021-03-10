import React from 'react';
import { PaintStyle, TextAlignEnum, useFontManager } from 'react-canvaskit';
import useAnimationFrame from './useAnimationFrame';
const fontPaint = { style: PaintStyle.Fill, antiAlias: true };
const X = 250;
const Y = 250;
const paragraphText = 'The quick brown fox 🦊 ate a zesty hamburgerfonts 🍔.\nThe 👩‍👩‍👧‍👧 laughed.';
export default () => {
    const skParagraphRef = React.useRef(null);
    const fontManager = useFontManager();
    const calcWrapTo = (time) => 350 + 150 * Math.sin(time / 2000);
    const [wrapTo, setWrapTo] = React.useState(calcWrapTo(performance.now()));
    useAnimationFrame(time => setWrapTo(calcWrapTo(time)));
    return (React.createElement("ck-canvas", { clear: '#FFFFFF' },
        React.createElement("ck-paragraph", { fontManager: fontManager, ref: skParagraphRef, textStyle: {
                color: '#000000',
                // Noto Mono is the default canvaskit font, we use it as a fallback
                fontFamilies: ['Noto Mono', 'Roboto', 'Noto Color Emoji'],
                fontSize: 50
            }, textAlign: TextAlignEnum.Left, maxLines: 7, ellipsis: '...', layout: wrapTo }, paragraphText),
        React.createElement("ck-line", { x1: wrapTo, y1: 0, x2: wrapTo, y2: 400, paint: fontPaint })));
};
