import React from 'react';
import { createRoot } from 'react-dom/client';
import { PopupApp } from '../../src/popup-ui';

const style = document.createElement('style');
style.textContent = `body{margin:0;width:350px;color:#17252c;background:#f6faf7;font:14px system-ui}main{padding:18px}h1{font-size:20px;margin:0;color:#176b4a}p{line-height:1.5;color:#607269}label{display:block;margin:14px 0;font-weight:600}input{box-sizing:border-box;width:100%;display:block;margin-top:5px;padding:9px;border:1px solid #cbdad0;border-radius:8px;font:inherit}.row{display:flex;justify-content:space-between;align-items:center;margin:10px 0}button{border:1px solid #bad2c2;border-radius:8px;background:white;padding:8px 11px;cursor:pointer}button:disabled{opacity:.55;cursor:default}form button[type=submit]{width:100%;margin-top:14px;background:#176b4a;color:white}.server{overflow-wrap:anywhere}label{margin-bottom:5px}input+label{margin-top:14px}.primary{background:#176b4a;color:white}.hint{font-size:12px}hr{border:0;border-top:1px solid #dbe7dc;margin:18px 0}`;
document.head.append(style);
createRoot(document.getElementById('root')!).render(<PopupApp />);
