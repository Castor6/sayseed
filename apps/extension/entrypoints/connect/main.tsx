import React from 'react';
import { createRoot } from 'react-dom/client';
import { ConnectionApp } from '../../src/connection-ui';
import './style.css';

createRoot(document.getElementById('root')!).render(<ConnectionApp />);
