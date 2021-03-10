import * as React from 'react';
// @ts-ignore
export let useGreenfield = undefined;
// @ts-ignore
export let GreenfieldProvider = undefined;
export function initGreenfieldContext(contextConfig) {
    const FrameContext = React.createContext(contextConfig);
    useGreenfield = () => React.useContext(FrameContext);
    GreenfieldProvider = ({ children }) => React.createElement(FrameContext.Provider, { value: contextConfig }, children);
}
