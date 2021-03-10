import React from 'react';
import { FontManagerProvider } from 'react-canvaskit';
import ParagraphDemo from './ParagraphDemo';
const robotoPromise = fetch('https://storage.googleapis.com/skia-cdn/google-web-fonts/Roboto-Regular.ttf')
    .then((resp) => resp.arrayBuffer());
const notoColorEmojiPromise = fetch('https://storage.googleapis.com/skia-cdn/misc/NotoColorEmoji.ttf')
    .then((resp) => resp.arrayBuffer());
const fontsPromise = Promise.all([robotoPromise, notoColorEmojiPromise]);
export const App = () => {
    const [fonts, setFonts] = React.useState(undefined);
    fontsPromise.then(fetchedFonts => setFonts(fetchedFonts));
    return (React.createElement(FontManagerProvider, { fontData: fonts },
        React.createElement(ParagraphDemo, null)));
};
