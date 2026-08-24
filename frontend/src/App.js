import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Archi from "@/components/Archi";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Archi />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
