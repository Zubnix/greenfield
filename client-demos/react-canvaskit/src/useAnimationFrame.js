import React from 'react';
import { useGreenfield } from './GreenfieldContext';
export default (callback) => {
    const { requestSurfaceFrame } = useGreenfield();
    const animate = (time) => {
        callback(time);
        requestSurfaceFrame(animate);
    };
    React.useEffect(() => requestSurfaceFrame(animate), []); // Make sure the effect runs only once
};
