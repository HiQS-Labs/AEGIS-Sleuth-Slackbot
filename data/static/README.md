
# Overview

This folder contains static data files required by the app. They are versioned and will be correctly deployed to the
server when we do a `git pull` on the server.

Data generated at runtime is stored in the `data/runtime` folder which is ignored in the `.gitignore` file so that it
is not overwritten when we do a `git pull` on the server.