import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppProvider, useAppContext } from "./context/AppContext";
import { Sidebar } from "./components/layout/Sidebar";
import { HomePage } from "./pages/HomePage";
import { PlayersPage } from "./pages/PlayersPage";
import { CharacterListsPage } from "./pages/CharacterListsPage";
import { TournamentSetupPage } from "./pages/TournamentSetupPage";
import { BracketPage } from "./pages/BracketPage";
import { TournamentPlayerCardsPage } from "./pages/TournamentPlayerCardsPage";
import { TournamentAdminsPage } from "./pages/TournamentAdminsPage";

function AppShell() {
  const { initialized } = useAppContext();

  if (!initialized) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <div className="text-4xl mb-3">🏆</div>
          <p className="text-gray-500 text-sm">読み込み中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/players" element={<PlayersPage />} />
          <Route path="/character-lists" element={<CharacterListsPage />} />
          <Route path="/tournament/setup" element={<TournamentSetupPage />} />
          <Route path="/tournament/bracket" element={<BracketPage />} />
          <Route path="/tournament/player-cards" element={<TournamentPlayerCardsPage />} />
          <Route path="/tournament/admins" element={<TournamentAdminsPage />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <AppShell />
      </AppProvider>
    </BrowserRouter>
  );
}

export default App;

