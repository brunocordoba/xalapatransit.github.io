import { Link } from 'wouter';

export default function Header() {
  return (
    <header className="bg-gradient-to-r from-blue-700 to-blue-500 text-white shadow-md">
      <div className="container mx-auto px-4 py-3 flex justify-between items-center">
        <Link href="/" className="text-xl font-bold">
          Rutas Xalapa
        </Link>
        <nav>
          <ul className="flex space-x-6">
            <li>
              <Link href="/" className="hover:underline">
                Mapa
              </Link>
            </li>
            <li>
              <Link href="/planificador" className="hover:underline">
                Planificador
              </Link>
            </li>
            <li>
              <Link href="/paradas-cercanas" className="hover:underline">
                Paradas Cercanas
              </Link>
            </li>
            <li>
              <Link href="/editor" className="hover:underline">
                Editor
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}