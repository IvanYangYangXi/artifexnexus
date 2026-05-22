// Copyright Artifex Nexus. All Rights Reserved.
// Minimal utility class — only RunPythonAndCapture needed for save intercept

#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"

class FArtifexNexusManageUtils
{
public:
	/** Execute Python code via IPythonScriptPlugin and capture the JSON result */
	static FString RunPythonAndCapture(const FString& PythonCode);
};
