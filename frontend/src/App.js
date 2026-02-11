// app.js

import React from 'react';
import Dashboard from './Dashboard';

function App() {
  // You can pass userId and borewellNo as props
  // For example, from URL parameters, authentication, or config
  
  return (
    <div className="App">
      <Dashboard userId="1" borewellNo="BW001" />
    </div>
  );
}

export default App;