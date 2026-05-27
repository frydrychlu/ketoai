## KetoAI - MVP

### Główny problem
Skrupulatne śledzenie diety ketogenicznej wymaga codziennego monitorowania wielu parametrów jednocześnie: makroskładników posiłków, wydatku energetycznego z aktywności fizycznej oraz biomarkerów takich jak poziom ketonów, glukozy i indeks GKI. Robienie tego ręcznie z pomocą ogólnego AI jest żmudne i nie daje możliwości analizy trendów w czasie. Brakuje narzędzia, które agreguje wszystkie te dane w jednym miejscu i pozwala zrozumieć zależności między dietą, aktywnością a stanem ketozy.

### Najmniejszy zestaw funkcjonalności
- system kont użytkownika (rejestracja i logowanie)
- możliwość tworzenia profilu zdrowotnego (wiek, waga, wzrost, poziom aktywności, cele zdrowotne itp.)
- możliwość ręcznego wprowadzania posiłków z automatycznym rozbiciem na makroskładniki
- agregacja makroskładników z wszystkich posiłków danego dnia — dzienny podsumowanie kalorii i makro
- możliwość ręcznego wprowadzania aktywności fizycznej z szacunkowym wydatkiem kalorycznym
- możliwość ręcznego wprowadzania biomarkerów (ketony, glukoza, GKI)
- możliwość ręcznego wprowadzania parametrów takich jak samopoczucie, energia, jakość sen, biometeorologiczne warunki, ilość wypitej wody itp.
- możliwość ręcznego dodawania wszelikich innych informacji, które użytkownik uzna za istotne w analizie AI
- dashboard z wizualizacją trendów biomarkerów w czasie i ich korelacją z dietą i aktywnością
- analiza AI: na żądanie użytkownika AI analizuje parametry keto/gluko/GKI z ostatnich kilku dni i wskazuje potencjalne przyczyny odchyleń od ketozy (np. zbyt duża ilość węglowodanów, niewystarczająca aktywność).
- czat z AI: użytkownik może zadawać pytania dotyczące swoich danych, trendów i potencjalnych korelacji, a AI odpowiada na podstawie zgromadzonych danych i analizy.

### Co NIE wchodzi w zakres MVP
- możliwość dodawania wyników badań laboratoryjnych
- możliwość dodawania aktywności fizycznej zintegrowanej z urządzeniami typu smartwatch i aplikacjami fitness
- możliwość wyświetlania szczegółów z poziomu zwizualizowanego trendu
- możliwość dodawania przewlekłych schorzeń i leków
- możliwość dodawania suplementów diety
- eksport danych do CSV lub PDF
- powiadomienia i przypomnienia
- obsługa wyjątków jak np brakujące dane, błędne dane, itp.

### Kryteria sukcesu
- użytkownik codziennie przez co najmniej 2 tygodnie wprowadza dane o posiłkach, aktywności i biomarkerach
- użytkownik śledzi trendy biomarkerów ketozy w czasie i widzi ich korelację z dietą i aktywnością
