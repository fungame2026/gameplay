#!/bin/bash

ARG=$1

if [ "$ARG" = "--help" ] || [ "$ARG" = "-help" ]; then
    npx ts-node -r tsconfig-paths/register src/main.ts --help
elif [ -z "$ARG" ]; then
    npx ts-node -r tsconfig-paths/register src/main.ts
else
    npx ts-node -r tsconfig-paths/register src/main.ts "$ARG"
fi