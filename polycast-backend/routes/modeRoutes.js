const express = require('express');
const router = express.Router();
// isTextMode will be managed in server.js and passed to routes that need it,
// or we use a getter/setter mechanism if direct access is too complex.
// For now, these routes will need a way to access and modify isTextMode.

// This module needs access to `isTextMode` and `saveModeToDisk`
// We will pass them from server.js when setting up the routes.
module.exports = (getIsTextMode, setIsTextMode, saveModeToDisk) => {
    // Endpoint to get current mode
    router.get('/mode', (req, res) => {
        res.json({ isTextMode: getIsTextMode() });
    });

    // Endpoint to set current mode
    router.post('/mode', (req, res) => {
        if (typeof req.body.isTextMode === 'boolean') {
            setIsTextMode(req.body.isTextMode); // Use setter
            saveModeToDisk(getIsTextMode()); // Pass current value to save
            res.json({ isTextMode: getIsTextMode() });
        } else {
            res.status(400).json({ error: 'Missing or invalid isTextMode' });
        }
    });
    return router;
};
