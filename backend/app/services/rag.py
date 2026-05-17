"""
rag.py — LangChain-based Retrieval-Augmented Generation service.

Uses FAISS for vector storage and supports both OpenAI and Google Gemini
as the LLM backend (configured via environment variables).
"""

import os
from typing import Optional

from langchain_community.document_loaders import PyPDFLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter


class RAGService:
    """
    Manages a FAISS vector store built from uploaded PDFs.
    Answers student questions by retrieving relevant chunks and
    passing them to an LLM with a focused prompt.
    """

    def __init__(self):
        self.vector_store = None
        self._embeddings = None
        self._llm = None
        self._init_models()

    def _init_models(self):
        """Lazy-initialise embedding model and LLM from env vars."""
        google_key = os.getenv("GOOGLE_API_KEY")
        openai_key = os.getenv("OPENAI_API_KEY")

        try:
            if google_key:
                from langchain_google_genai import (
                    GoogleGenerativeAIEmbeddings,
                    ChatGoogleGenerativeAI,
                )
                self._embeddings = GoogleGenerativeAIEmbeddings(
                    model="models/embedding-001"
                )
                self._llm = ChatGoogleGenerativeAI(
                    model="gemini-1.5-flash", temperature=0.3
                )
            elif openai_key:
                from langchain_openai import OpenAIEmbeddings, ChatOpenAI
                self._embeddings = OpenAIEmbeddings()
                self._llm = ChatOpenAI(model="gpt-3.5-turbo", temperature=0.3)
        except Exception:
            # Models unavailable — stub mode
            self._embeddings = None
            self._llm = None

    def process_pdf(self, file_path: str) -> int:
        """
        Load a PDF, split into chunks, and index into FAISS.
        Returns the number of chunks created.
        """
        loader = PyPDFLoader(file_path)
        docs = loader.load()

        splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000, chunk_overlap=200
        )
        splits = splitter.split_documents(docs)

        if self._embeddings:
            from langchain_community.vectorstores import FAISS

            if self.vector_store is None:
                self.vector_store = FAISS.from_documents(splits, self._embeddings)
            else:
                self.vector_store.add_documents(splits)

        return len(splits)

    def ask_question(self, query: str) -> str:
        """
        Retrieve relevant chunks and generate an answer.
        Falls back to a stub response if no LLM is configured.
        """
        if self.vector_store is None or self._llm is None:
            return (
                f"[Stub mode] No PDF indexed or LLM not configured. "
                f"Your question was: \"{query}\". "
                "Set GOOGLE_API_KEY or OPENAI_API_KEY and upload a PDF to enable full RAG."
            )

        docs = self.vector_store.similarity_search(query, k=4)
        context = "\n\n".join(d.page_content for d in docs)

        prompt = (
            "You are a helpful academic study assistant. "
            "Answer the student's question using ONLY the context below. "
            "If the answer is not in the context, say so clearly.\n\n"
            f"Context:\n{context}\n\n"
            f"Question: {query}\n\nAnswer:"
        )

        response = self._llm.invoke(prompt)
        return response.content if hasattr(response, "content") else str(response)


# Singleton
rag_assistant = RAGService()
