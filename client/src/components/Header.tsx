import { useState } from 'react';
import { MapIcon } from 'lucide-react';

export default function Header() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };
  
  return (
    <header className="bg-primary text-white shadow-md z-10">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <MapIcon className="h-8 w-8" />
          <h1 className="text-xl font-bold">RutasXalapa</h1>
        </div>
        
        <div className="hidden md:flex items-center space-x-4">
          <button className="px-3 py-1 rounded hover:bg-blue-600 transition">Acerca de</button>
          <button className="px-3 py-1 rounded hover:bg-blue-600 transition">Contacto</button>
          <button className="bg-accent px-4 py-1 rounded font-medium hover:bg-orange-500 transition">Reportar Problema</button>
        </div>
        
        <button className="md:hidden" onClick={toggleMobileMenu}>
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>
      
      <div className={`md:hidden bg-blue-700 ${isMobileMenuOpen ? '' : 'hidden'}`}>
        <div className="container mx-auto px-4 py-2 flex flex-col space-y-2">
          <button className="px-3 py-2 rounded hover:bg-blue-600 transition text-left">Acerca de</button>
          <button className="px-3 py-2 rounded hover:bg-blue-600 transition text-left">Contacto</button>
          <button className="bg-accent px-4 py-2 rounded font-medium hover:bg-orange-500 transition text-left">Reportar Problema</button>
        </div>
      </div>
    </header>
  );
}
