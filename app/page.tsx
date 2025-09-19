import Uploader from "./components/Uploader";

export default function Home() {
  return (
    <main className="p-4">
      <h1 className="text-xl font-bold mb-4">Upload Documente</h1>
      <Uploader />
    </main>
  );
}